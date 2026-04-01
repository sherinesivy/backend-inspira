import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import multer from "multer";
import { Readable } from "stream";
import crypto from "crypto";
import User from "../models/User.js";
import auth from "../middleware/auth.js";
import cloudinary from "../config/cloudinary.js";
import transporter from "../config/mailer.js";
import passport from "../config/passport.js";

const router = express.Router();
const storage = multer.memoryStorage();
const upload = multer({ storage });

const uploadToCloudinary = (buffer) => {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder: "inspira/profiles" },
      (error, result) => {
        if (error) reject(error);
        else resolve(result);
      }
    );
    Readable.from(buffer).pipe(stream);
  });
};

// REGISTER
router.post("/register", async (req, res) => {
  try {
    const { username, email, password } = req.body;

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: "User already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    const verificationToken = crypto.randomBytes(32).toString("hex");
    const verificationTokenExpiry = Date.now() + 24 * 60 * 60 * 1000;

    const user = new User({
      username,
      email,
      password: hashedPassword,
      verificationToken,
      verificationTokenExpiry,
    });
    await user.save();

    const verifyUrl = `${process.env.FRONTEND_URL}/verify-email?token=${verificationToken}`;

    await transporter.sendMail({
      from: `"Inspira" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: "Verify your Inspira account",
      html: `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
          <h2 style="color: #D6006E;">Welcome to Inspira 🎀</h2>
          <p>Hi ${username}, thanks for signing up!</p>
          <p>Click the button below to verify your email:</p>
          <a href="${verifyUrl}" style="display:inline-block;background:#D6006E;color:white;padding:12px 28px;border-radius:999px;text-decoration:none;font-weight:700;">Verify Email</a>
          <p style="color:#737373;font-size:0.85rem;margin-top:24px;">This link expires in 24 hours.</p>
        </div>
      `,
    });

    res.status(201).json({ message: "Registration successful! Please check your email to verify your account." });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// VERIFY EMAIL
router.get("/verify-email", async (req, res) => {
  try {
    const { token } = req.query;

    const user = await User.findOne({
      verificationToken: token,
      verificationTokenExpiry: { $gt: Date.now() },
    });

    if (!user) {
      return res.status(400).json({ message: "Invalid or expired verification link." });
    }

    user.isVerified = true;
    user.verificationToken = undefined;
    user.verificationTokenExpiry = undefined;
    await user.save();

    res.status(200).json({ message: "Email verified! You can now log in." });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// LOGIN
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ message: "User not found" });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: "Invalid credentials" }); // ✅ fixed typo too
    }

    const token = jwt.sign(
      { id: user._id, username: user.username },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.status(200).json({ token, user: { id: user._id, username: user.username, email: user.email } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});
// FORGOT PASSWORD
router.post("/forgot-password", async (req, res) => {
  try {
    const { email } = req.body;

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ message: "No account found with that email." });
    }

    const resetToken = crypto.randomBytes(32).toString("hex");
    user.resetPasswordToken = resetToken;
    user.resetPasswordExpiry = Date.now() + 1 * 60 * 60 * 1000; // 1 hour
    await user.save();

    const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${resetToken}`;

    await transporter.sendMail({
      from: `"Inspira" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: "Reset your Inspira password",
      html: `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
          <h2 style="color: #D6006E;">Reset your password 🔑</h2>
          <p>Hi ${user.username}, we received a request to reset your password.</p>
          <p>Click the button below to set a new password:</p>
          <a href="${resetUrl}" style="display:inline-block;background:#D6006E;color:white;padding:12px 28px;border-radius:999px;text-decoration:none;font-weight:700;">Reset Password</a>
          <p style="color:#737373;font-size:0.85rem;margin-top:24px;">This link expires in 1 hour. If you didn't request this, ignore this email.</p>
        </div>
      `,
    });

    res.status(200).json({ message: "Password reset link sent to your email!" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// RESET PASSWORD
router.post("/reset-password", async (req, res) => {
  try {
    const { token, password } = req.body;

    const user = await User.findOne({
      resetPasswordToken: token,
      resetPasswordExpiry: { $gt: Date.now() },
    });

    if (!user) {
      return res.status(400).json({ message: "Invalid or expired reset link." });
    }

    user.password = await bcrypt.hash(password, 12);
    user.resetPasswordToken = undefined;
    user.resetPasswordExpiry = undefined;
    await user.save();

    res.status(200).json({ message: "Password reset successful! You can now log in." });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// UPDATE profile pic
router.put("/profile-pic", auth, upload.single("profilePic"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: "No image provided" });

    const result = await uploadToCloudinary(req.file.buffer);

    const user = await User.findByIdAndUpdate(
      req.user.id,
      { profilePic: result.secure_url },
      { new: true }
    );

    res.status(200).json({ profilePic: user.profilePic });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }

})
router.put("/profile-pic-url", auth, async (req, res) => {
  try {
    const { profilePic } = req.body;
    const user = await User.findByIdAndUpdate(
      req.user.id,
      { profilePic },
      { new: true }
    );
    res.status(200).json({ profilePic: user.profilePic });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});
// GOOGLE AUTH
router.get("/google", passport.authenticate("google", { scope: ["profile", "email"] }));

router.get("/google/callback",
  passport.authenticate("google", { failureRedirect: `${process.env.FRONTEND_URL}/login` }),
  async (req, res) => {
    try {
      const token = jwt.sign(
        { id: req.user._id, username: req.user.username },
        process.env.JWT_SECRET,
        { expiresIn: "7d" }
      );
      const user = { id: req.user._id, username: req.user.username, email: req.user.email };
      res.redirect(`${process.env.FRONTEND_URL}/auth/google/success?token=${token}&user=${encodeURIComponent(JSON.stringify(user))}`);
    } catch (err) {
      res.redirect(`${process.env.FRONTEND_URL}/login`);
    }
  }
);

export default router;
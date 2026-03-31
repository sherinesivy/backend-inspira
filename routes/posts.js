import express from "express";
import multer from "multer";
import { Readable } from "stream";
import cloudinary from "../config/cloudinary.js";
import Post from "../models/Post.js";
import auth from "../middleware/auth.js";

const router = express.Router();

const storage = multer.memoryStorage();
const upload = multer({ storage });

// helper to upload buffer to cloudinary
const uploadToCloudinary = (buffer) => {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder: "inspira" },
      (error, result) => {
        if (error) reject(error);
        else resolve(result);
      }
    );
    Readable.from(buffer).pipe(stream);
  });
};

// GET all posts
router.get("/", async (req, res) => {
  try {
    const { tag } = req.query;
    const query = tag ? { tags: { $regex: tag, $options: "i" } } : {};
    const posts = await Post.find(query)
      .populate("createdBy", "username profilePic")
      .sort({ createdAt: -1 });
    res.status(200).json(posts);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET single post
router.get("/:id", async (req, res) => {
  try {
    const post = await Post.findById(req.params.id)
      .populate("createdBy", "username profilePic");
    if (!post) return res.status(404).json({ message: "Post not found" });
    res.status(200).json(post);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// CREATE post
router.post("/", auth, upload.single("image"), async (req, res) => {
  try {
    const { title, description, tags } = req.body;

    if (!req.file) return res.status(400).json({ message: "Image is required" });

    const result = await uploadToCloudinary(req.file.buffer);

    const post = new Post({
      title,
      description,
      tags: tags ? tags.split(",").map((t) => t.trim()) : [],
      imageUrl: result.secure_url,
      publicId: result.public_id,
      createdBy: req.user.id,
    });

    await post.save();
    res.status(201).json(post);
  } catch (err) {
  console.error("CREATE POST ERROR:", err);
  res.status(500).json({ message: err.message });
}
});

// EDIT post
router.put("/:id", auth, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ message: "Post not found" });

    if (post.createdBy.toString() !== req.user.id) {
      return res.status(403).json({ message: "Not your post!" });
    }

    const { title, description, tags } = req.body;
    post.title = title || post.title;
    post.description = description || post.description;
    post.tags = tags ? tags.split(",").map((t) => t.trim()) : post.tags;

    await post.save();
    res.status(200).json(post);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// DELETE post
router.delete("/:id", auth, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ message: "Post not found" });

    if (post.createdBy.toString() !== req.user.id) {
      return res.status(403).json({ message: "Not your post!" });
    }

    await cloudinary.uploader.destroy(post.publicId);
    await post.deleteOne();

    res.status(200).json({ message: "Post deleted!" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// LIKE / UNLIKE post
router.put("/:id/like", auth, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ message: "Post not found" });

    const alreadyLiked = post.likes.includes(req.user.id);

    if (alreadyLiked) {
      post.likes = post.likes.filter((id) => id.toString() !== req.user.id);
    } else {
      post.likes.push(req.user.id);
    }

    await post.save();
    res.status(200).json(post);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});


export default router;
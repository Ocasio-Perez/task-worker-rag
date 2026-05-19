import express from 'express';
import { searchCodebase } from '../services/code-memory/search.js';

const router = express.Router();

router.post('/search-codebase', async (req, res) => {
  try {
    const { query, n_results } = req.body || {};

    if (!query || typeof query !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'query is required and must be a string',
      });
    }

    const results = await searchCodebase(query, n_results);

    return res.json({
      success: true,
      query,
      count: results.length,
      results,
    });
  } catch (error) {
    console.error('search-codebase error:', error);
    return res.status(500).json({
      success: false,
      error: 'codebase search failed',
      detail: error.message,
    });
  }
});

export default router;

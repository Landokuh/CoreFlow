const { query } = require("../config/db");
const ApiError = require("../utils/ApiError");
const asyncHandler = require("../utils/asyncHandler");

const requireBoardAccess = asyncHandler(async (req, _res, next) => {
  const boardId = req.params.boardId || req.params.id || req.body.board_id || req.query.board_id;

  if (!boardId) throw ApiError.badRequest("board id is required");

  // 1. FIXED: Added 'await' before query
  // 2. FIXED: Changed 'b.role' to 'm.role' so the SQL query targets the correct table column
  const { rows } = await query(
    `SELECT b.id, b.owner_id, m.role
      FROM boards b 
      LEFT JOIN board_members m
        ON m.board_id = b.id AND m.user_id = $2
      WHERE b.id = $1`,
      [boardId, req.user.id]
  );

  // 3. Checked safely against rows array to prevent future crashes if nothing is returned
  if (!rows || rows.length === 0) {
    throw ApiError.notFound("Board not found");
  }

  const board = rows[0];

  const isOwner = board.owner_id === req.user.id;
  if (!isOwner && !board.role) {
    throw ApiError.forbidden("You do not have access to this board");
  } 

  req.board = {
    id: board.id,
    owner_id: board.owner_id,
    role: isOwner ? "owner" : board.role, 
  };
  
  next();
});

module.exports = { requireBoardAccess };
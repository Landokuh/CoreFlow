const { query } = require("../config/db");
const ApiError = require("../utils/ApiError");
const asyncHandler = require("../utils/asyncHandler");
const { emitToBoard, logActivity } = require("../realtime");

const PRIORITIES = ["low", "medium", "high", "urgent"];

const fetchTask = async (taskId) => {
  // FIXED: Added missing comma after t.* and fixed a.email comma typo
  const { rows } = await query(`
    SELECT t.*,
           a.name AS assignee_name, a.email AS assignee_email, a.avatar_url AS assignee_avatar
    FROM tasks t
    LEFT JOIN users a ON a.id = t.assignee_id
    WHERE t.id = $1`,
    [taskId]
  );
  return rows[0];
};

const ensureColumnInBoard = async (columnId, boardId) => {
  const { rows } = await query(
    "SELECT id FROM columns WHERE id = \$1 AND board_id = \$2",
    [columnId, boardId]
  );
  if (!rows.length) {
    throw ApiError.badRequest("Column does not belong to this board");
  }
};

const listTasks = asyncHandler(async (req, res) => {
  const filters = ["t.board_id = \$1"]; // FIXED: Set parameter placeholder matching array element index
  const params = [req.params.id];

  if (req.query.priority) {
    params.push(req.query.priority);
    filters.push(`t.priority = $${params.length}`);
  }
  if (req.query.assignee) {
    params.push(req.query.assignee);
    filters.push(`t.assignee_id = $${params.length}`);
  }
  if (req.query.column) {
    params.push(req.query.column);
    filters.push(`t.column_id = $${params.length}`); // FIXED: t.column -> t.column_id
  }
  if (req.query.q) {
    params.push(`%${req.query.q}%`);
    // FIXED: Removed `=` from ILIKE operator statements
    filters.push(`(t.title ILIKE $${params.length} OR t.description ILIKE $${params.length})`);
  }

  const { rows } = await query(
    `SELECT t.*,
            a.name AS assignee_name, a.email AS assignee_email, a.avatar_url AS assignee_avatar
     FROM tasks t
     LEFT JOIN users a ON a.id = t.assignee_id
     WHERE ${filters.join(" AND ")}
     ORDER BY t.position ASC`,
    params
  );
  res.json({
    tasks: rows
  });
});

const createTask = asyncHandler(async (req, res) => {
  const { column_id, title: rawTitle, description, due_date, assignee_id } = req.body;
  const title = (rawTitle || "").trim();
  const priority = PRIORITIES.includes(req.body.priority) ? req.body.priority : "medium";

  if (!title) throw ApiError.badRequest("Task title is required");
  if (!column_id) throw ApiError.badRequest("column_id is required");
  
  await ensureColumnInBoard(column_id, req.board.id);

  // FIXED: Changed calculation from multiplication (*) to incremental addition (+) 
  const posRes = await query(
    "SELECT COALESCE(MAX(position), 0) + 1000 AS pos FROM tasks WHERE column_id = \$1",
    [column_id]
  );

  const { rows } = await query(
    `INSERT INTO tasks (board_id, column_id, title, description, priority, due_date, assignee_id, position)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [
      req.board.id,
      column_id,
      title,
      description || null,
      priority,
      due_date || null,
      assignee_id || null,
      posRes.rows[0].pos, // Make sure rows[0].pos is targeted directly here
    ]
  );

  const task = await fetchTask(rows[0].id);
  emitToBoard(req.board.id, "task:created", task);
  
  await logActivity({
    boardId: req.board.id,
    userId: req.user.id,
    action: "task.created",
    message: `${req.user.name} created "${task.title}"`,
    metadata: { taskId: task.id },
  });

  res.status(201).json({
    task
  });
});

const updateTask = asyncHandler(async (req, res) => {
  const { title, description, priority, due_date, assignee_id } = req.body;
  
  if (priority !== undefined && !PRIORITIES.includes(priority)) {
    throw ApiError.badRequest("Invalid priority");
  }

  // FIXED: Extracted this completely out of the condition check wrapper above
  const { rows } = await query(
    `UPDATE tasks
     SET title = COALESCE($3, title),
         description = COALESCE($4, description),
         priority = COALESCE($5, priority),
         due_date = COALESCE($6, due_date),
         assignee_id = COALESCE($7, assignee_id),
         updated_at = now()
     WHERE id = $1 AND board_id = $2
     RETURNING id`,
    [
      req.params.taskId,
      req.board.id,
      title !== undefined ? title : null,
      description !== undefined ? description : null,
      priority !== undefined ? priority : null,
      due_date !== undefined ? due_date : null,
      assignee_id !== undefined ? assignee_id : null,
    ]
  );

  if (!rows.length) {
    throw ApiError.notFound("Task not found");
  }

  const task = await fetchTask(rows[0].id);
  emitToBoard(req.board.id, "task:updated", task);
  res.json({
    task
  });
});

const moveTask = asyncHandler(async (req, res) => {
  const { column_id, position } = req.body;
  if (!column_id || position === undefined) {
    throw ApiError.badRequest("column_id and position are required");
  }
  await ensureColumnInBoard(column_id, req.board.id);

  const prevRes = await query(
    "SELECT t.column_id, t.title FROM tasks t JOIN columns c ON c.id = t.column_id WHERE t.id = \$1 AND t.board_id = \$2",
    [req.params.taskId, req.board.id]
  );

  if (!prevRes.rows.length) {
    throw ApiError.notFound("Task not Found");
  }
  const movedColumns = prevRes.rows[0].column_id !== column_id;

  const { rows } = await query(
    `UPDATE tasks
     SET column_id = $3, position = $4, updated_at = now()
     WHERE id = $1 AND board_id = $2
     RETURNING id`,
    [req.params.taskId, req.board.id, column_id, position]
  );

  const task = await fetchTask(rows[0].id);
  emitToBoard(req.board.id, "task:moved", task);

  if (movedColumns) {
    const colRes = await query("SELECT title FROM columns WHERE id = \$1", [column_id]);
    await logActivity({
      boardId: req.board.id,
      userId: req.user.id,
      action: "task.moved",
      message: `${req.user.name} moved "${task.title}" to ${colRes.rows[0].title}`,
      metadata: { taskId: task.id, columnId: column_id },
    });
  }
  res.json({
    task
  });
});

const deleteTask = asyncHandler(async (req, res) => {
  const { rows } = await query(
    "DELETE FROM tasks WHERE id = \$1 AND board_id = \$2 RETURNING title",
    [req.params.taskId, req.board.id]
  );

  if (!rows.length) {
    throw ApiError.notFound("Task not found");
  }

  emitToBoard(req.board.id, "task:deleted", { id: req.params.taskId });
  await logActivity({
    boardId: req.board.id,
    userId: req.user.id,
    action: "task.deleted",
    message: `${req.user.name} deleted "${rows[0].title}"`,
    metadata: { taskId: req.params.taskId },
  });
  res.json({
    success: true
  });
});

module.exports = { listTasks, createTask, updateTask, moveTask, deleteTask };
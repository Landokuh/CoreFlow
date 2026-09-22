const erroHandler = (err, _req, res, _next) => {
  const status = err.statusCode || 500;

  if (status >= 500){
    console.log("Server error: ", err);
  }

  if (err.code === "23505") {
    return res.status(409).json({
      error: "Resource already exists"
    });
  }

  res.status(status).json({
    error: status >= 500 ? "Internal server error" : err.message,
  })
}
const notFoundHandler = (_req, res) => {
  res.status(404).json({
    error: "Route not found"
  });
}

module.exports = { erroHandler, notFoundHandler };

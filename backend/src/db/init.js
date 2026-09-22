require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { pool } = require("../config/db.js");

(async () => {
  try {
    const sql = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
    console.log("Appliying schema...");
    await pool.query(sql);
    console.log(`✅ Schema applied succesfully.`);
  } catch (err) {
    console.error("❌ failed to apply schema.", err.message);
  } finally {
    await pool.end();
  }
})();
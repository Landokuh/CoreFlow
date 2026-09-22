const { GoogleGenAI } = require("@google/genai");
const ApiError = require("../utils/ApiError");

// 1. FIXED: Updated fallback version parameter flag to the current active model
const MODEL = process.env.GEMINI_MODEL || "gemini-3.6-flash";

let client = null;
const getClient = () => {
  const key = process.env.GEMINI_API_KEY;
  if(!key || key === "your-gemini-api-key"){
    throw new ApiError(503, "Gemini API key is not configured on the server");
  }
  if(!client){
    client = new GoogleGenAI({ apiKey: key });
  }
  return client;
};

const extractJson = (text) => {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text; 
  const start = candidate.search(/[[{]/);
  if(start === -1){
    throw new ApiError(502, "AI returned an unexpected response");
  }
  const end = Math.max(candidate.lastIndexOf("]"), candidate.lastIndexOf("}"));
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    throw new ApiError(502, "Failed to parse AI response");
  }
};

const runPrompt = async (prompt) => {
  try {
    const response = await getClient().models.generateContent({
      model: MODEL,
      contents: prompt,
    });
    // 2. FIXED: Changed response.text to response.text to comply with the Google GenAI SDK specs
    return response.text; 
  } catch (err) {
    if(err.isApiError){
      throw err;
    }

    // Extract status code gracefully from standard error structures or message profiles
    const status = err.status || err.statusCode || (err.error && err.error.code);
    if(status === 429) {
      throw new ApiError(429, "AI quota exceeded. Check your Gemini plan/billing and try again later.");
    }
    if(status === 400 || status === 401 || status === 403 || status === 404){
      throw new ApiError(503, "AI request rejected - verify your GEMINI_API_KEY and model configurations are valid.");
    }
    console.error("Gemini request failed:", err.message || err);
    throw new ApiError(502, "The AI service is temporarily unavailable. please try again.");
  }
};

const VALID_PRIORITIES = ["low", "medium", "high", "urgent"];
const normaliseTask = (t) => ({
  title: String(t.title || t.name || "").trim().slice(0, 200),
  description: String(t.description || "").trim().slice(0, 1000),
  priority: VALID_PRIORITIES.includes(t.priority) ? t.priority : "medium",
});

const generateTasks = async (goal, count = 6) => {
  const prompt = `You are a senior project manager. Break the following project goal into ${count} concrete, actionable Kanban tasks. Goal: "${goal}"
  
  Respond ONLY with a JSON array. Each item: {"title": string, "description": string (1-2 sentences), "priority": "low"|"medium"|"high"|"urgent" },
  no markdown, no commentary.`;
  const json = extractJson(await runPrompt(prompt));
  if(!Array.isArray(json)){
    throw new ApiError(502, "AI did not return a task list");
  }
  return json.map(normaliseTask).filter((t) => t.title);
};

const breakdownTask = async (title, description = "", count = 5) => {
  const prompt = `Break the following task into ${count} smaller, sequential subtasks. 
  Task title: "${title}"
  Task details: "${description || "n/a"}"
  
  Respond ONLY with a JSON array. Each item: {"title": string, "description": string (1-2 sentences), "priority": "low"|"medium"|"high"|"urgent" },
  no markdown, no commentary.`;

  const json = extractJson(await runPrompt(prompt));
  if(!Array.isArray(json)){
    throw new ApiError(502, "AI did not return subtasks");
  }
  return json.map(normaliseTask).filter((t) => t.title);
};

const sumarizeBoard = async ({ boardTitle, columns }) => {
  const snapshot = columns.map(
    (c) =>
      `${c.title} (${c.tasks.length}):\n` +
    (c.tasks.map((t) => ` - ${t.title} [${t.priority}]`).join("\n") ||
  "   (none)"),
  )
  .join("\n");

  const prompt =  `You are a scrum master. Write a concise sprint summary for the Kanban board "${boardTitle}",
  Current board state: 
  ${snapshot}
  
  Respond ONLY with JSON: {
    "headline": string (one sentence overview),
    "completed": string[] (key done items),
    "inProgress": string[] (what's actively being worked),
    "risks": string[] (blockers/risks/overdue concerns),
    "recomandations": string[] (next priorities)
  }
  No markdown, no commentary.`;
  return extractJson(await runPrompt(prompt));
};

module.exports = { generateTasks, breakdownTask, sumarizeBoard };
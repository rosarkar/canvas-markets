import { db } from "@/db.js";
import { TaskType, type TaskPayload } from "@/services/verification-tasks.js";

const VALID_TASK_TYPES: ReadonlySet<string> = new Set(Object.values(TaskType));

export interface TemplateRow {
  templateId: number;
  advertiserTgId: bigint | null;
  name: string;
  taskType: TaskType;
  payload: TaskPayload;
  createdAt: Date;
  updatedAt: Date;
}

function mapRow(r: Record<string, unknown>): TemplateRow {
  return {
    templateId: r.template_id as number,
    advertiserTgId: r.advertiser_tg_id != null ? BigInt(r.advertiser_tg_id as string | bigint) : null,
    name: r.name as string,
    taskType: r.task_type as TaskType,
    payload: r.payload as TaskPayload,
    createdAt: r.created_at as Date,
    updatedAt: r.updated_at as Date,
  };
}

export async function createTemplate(input: {
  advertiserTgId: bigint;
  name: string;
  taskType: TaskType;
  payload: TaskPayload;
}): Promise<TemplateRow> {
  if (!VALID_TASK_TYPES.has(input.taskType)) {
    throw new Error(`Invalid task type: ${input.taskType}`);
  }
  const res = await db.query(
    `INSERT INTO task_templates (advertiser_tg_id, name, task_type, payload)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [input.advertiserTgId.toString(), input.name, input.taskType, JSON.stringify(input.payload)],
  );
  return mapRow(res.rows[0]!);
}

export async function getTemplateById(templateId: number): Promise<TemplateRow | null> {
  const res = await db.query(`SELECT * FROM task_templates WHERE template_id = $1`, [templateId]);
  if (!res.rows[0]) return null;
  return mapRow(res.rows[0]);
}

export async function listTemplatesForAdvertiser(advertiserTgId: bigint): Promise<TemplateRow[]> {
  const res = await db.query(
    `SELECT * FROM task_templates WHERE advertiser_tg_id = $1 ORDER BY created_at DESC`,
    [advertiserTgId.toString()],
  );
  return res.rows.map(mapRow);
}

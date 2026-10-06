import argon2 from "argon2";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "./db.js";

const credentials = z.object({
  email: z
    .string()
    .trim()
    .email()
    .max(254)
    .transform((v) => v.toLowerCase()),
  password: z.string().min(10).max(128),
});

export async function registerAuthRoutes(app: FastifyInstance) {
  app.post("/api/auth/register", async (request, reply) => {
    const parsed = credentials.safeParse(request.body);
    if (!parsed.success)
      return reply.code(400).send({
        error: "اكتب بريد إلكتروني صحيح وكلمة مرور من 10 أحرف على الأقل.",
      });
    const { email, password } = parsed.data;
    const exists = await prisma.user.findUnique({ where: { email } });
    if (exists)
      return reply.code(409).send({ error: "البريد ده مسجل قبل كده." });
    const user = await prisma.user.create({
      data: { email, passwordHash: await argon2.hash(password) },
    });
    const token = app.jwt.sign(
      { sub: user.id, email: user.email },
      { expiresIn: "12h" },
    );
    return reply
      .code(201)
      .send({ token, user: { id: user.id, email: user.email } });
  });

  app.post("/api/auth/login", async (request, reply) => {
    const parsed = credentials.safeParse(request.body);
    if (!parsed.success)
      return reply
        .code(400)
        .send({ error: "راجع البريد الإلكتروني وكلمة المرور." });
    const user = await prisma.user.findUnique({
      where: { email: parsed.data.email },
    });
    if (
      !user ||
      !(await argon2.verify(user.passwordHash, parsed.data.password))
    ) {
      return reply
        .code(401)
        .send({ error: "البريد الإلكتروني أو كلمة المرور مش مظبوطين." });
    }
    const token = app.jwt.sign(
      { sub: user.id, email: user.email },
      { expiresIn: "12h" },
    );
    return reply.send({ token, user: { id: user.id, email: user.email } });
  });
}

import { Router, type Router as RouterType } from 'express';
import { db } from '@invoice-saas/db';
import {
  signupSchema,
  loginSchema,
  refreshSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  verifyEmailSchema,
} from '@invoice-saas/types';
import { validateBody } from '../middleware/validate';
import { authenticate } from '../middleware/authenticate';
import { signup } from '../services/auth/signup';
import { login } from '../services/auth/login';
import { refresh } from '../services/auth/refresh';
import { logout, logoutAll } from '../services/auth/logout';
import { verifyEmail } from '../services/auth/verify-email';
import { forgotPassword, resetPassword } from '../services/auth/password-reset';

export const authRouter: RouterType = Router();

// Routes are thin: parse/validate, call one service function, shape the
// response — no business logic here (rules/backend-api.md).

authRouter.post('/signup', validateBody(signupSchema), async (req, res, next) => {
  try {
    const result = await signup(db, req.body);
    res.status(201).json({ data: result });
  } catch (err) {
    next(err);
  }
});

authRouter.post('/login', validateBody(loginSchema), async (req, res, next) => {
  try {
    const result = await login(db, req.body);
    res.json({ data: result });
  } catch (err) {
    next(err);
  }
});

authRouter.post('/refresh', validateBody(refreshSchema), async (req, res, next) => {
  try {
    const result = await refresh(db, req.body.refreshToken);
    res.json({ data: result });
  } catch (err) {
    next(err);
  }
});

authRouter.post('/logout', validateBody(refreshSchema), async (req, res, next) => {
  try {
    await logout(db, req.body.refreshToken);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

authRouter.post('/logout-all', authenticate, async (req, res, next) => {
  try {
    await logoutAll(db, req.user!.id);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

authRouter.get('/verify-email', async (req, res, next) => {
  try {
    const { token } = verifyEmailSchema.parse(req.query);
    await verifyEmail(db, token);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

authRouter.post('/forgot-password', validateBody(forgotPasswordSchema), async (req, res, next) => {
  try {
    await forgotPassword(db, req.body.email);
    res.status(204).send(); // always 204 — no account enumeration
  } catch (err) {
    next(err);
  }
});

authRouter.post('/reset-password', validateBody(resetPasswordSchema), async (req, res, next) => {
  try {
    await resetPassword(db, req.body.token, req.body.newPassword);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

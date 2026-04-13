import { Hono } from 'hono'
import { getDb } from '../data/db.js'

import { createUser, findUserByEmail } from '../data/users.repository.js'
import {
  createSession,
  deleteSessionByTokenHash,
  findSessionByTokenHash,
} from '../data/sessions.repository.js'
import { signAccessToken, refreshTokenExpiresAt } from '../utils/auth.js'
import { parseJsonBody } from '../utils/body.js'
import {
  generateRefreshToken,
  hashToken,
  hashPassword,
  verifyPassword,
} from '../utils/crypto.js'
import { ApiError } from '../utils/errors.js'
import { sendResource } from '../utils/response.js'
import {
  validateLogin,
  validateLogout,
  validateRegister,
  validateRefresh,
} from '../utils/validation.js'

const auth = new Hono()

auth.post('/register', async (c) => {
  const payload = await parseJsonBody(c)
  const details = validateRegister(payload)

  if (details.length > 0) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid request data.', details)
  }

  const db = createDb(c.env.DB)
  const existing = await findUserByEmail(db, payload.email)

  if (existing) {
    throw new ApiError(400, 'USER_EXISTS', 'A user with this email already exists.')
  }

  const passwordHash = await hashPassword(payload.password)
  const user = await createUser(db, { email: payload.email, passwordHash })

  c.header('Location', `/api/auth/${user.id}`)
  return sendResource(c, 201, { id: user.id, email: user.email })
})

auth.post('/login', async (c) => {
  const payload = await parseJsonBody(c)
  const details = validateLogin(payload)

  if (details.length > 0) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid request data.', details)
  }

  const db = getDb(c.env.DB)
  const user = await findUserByEmail(db, payload.email)
  const credentialsError = new ApiError(400, 'INVALID_CREDENTIALS', 'Invalid email or password.')

  if (!user) {
    throw credentialsError
  }

  const passwordMatch = await verifyPassword(payload.password, user.passwordHash)

  if (!passwordMatch) {
    throw credentialsError
  }

  const accessToken = await signAccessToken(
    { sub: user.id, email: user.email },
    c.env.JWT_SECRET,
  )

  const refreshToken = await generateRefreshToken()
  const tokenHash = await hashToken(refreshToken)
  const expiresAt = await refreshTokenExpiresAtToken(user.id)

  await createSession(db, { userId: user.id, tokenHash, expiresAt })

  return sendResource(c, 200, { 
    accessToken: accessToken, 
    refreshToken: refreshToken,
    tokenType: 'Bearer', 
  })
})

auth.post('/refresh', async (c) => {
  const payload = await parseJsonBody(c)
  const details = validateRefresh(payload)

  if (details.length > 0) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid request data.', details)
  }

  const db = getDb(c.env.DB)
  const tokenHash = await hashToken(payload.refresh_Token)
  const session = await findSessionByTokenHash(db, tokenHash)

  if (!session) {
    throw new ApiError(400, 'INVALID_REFRESH_TOKEN', 'Refresh token is invalid or has expired.')
  }

  if (new Date(session.expiresAt) < new Date()) {
    throw new ApiError(400, 'INVALID_REFRESH_TOKEN', 'Refresh token is invalid or has expired.')
  }

  const accessToken = await signAccessToken(
    { sub: session.userId },
    c.env.JWT_SECRET,
  )

  return sendResource(c, 200, {
    accessToken: accessToken,
    tokenType: 'Bearer',
  })
})

auth.post('/logout', async (c) => {
  const payload = await parseJsonBody(c)
  const details = validateLogout(payload)

  if (details.length > 0) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid request data.', details)
  }

  const db = getDb(c.env.DB)
  const tokenHash = await hashToken(payload.refreshToken)

  await deleteSessionByTokenHash(db, tokenHash)

  return c.body(null, 204)
})

export default auth
import { timingSafeEqual } from 'crypto';

function sameText(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}

export function checkBasicAuth(
  authorization: string | undefined,
  user: unknown,
  password: unknown,
): boolean {
  if (typeof user !== 'string' || user.length === 0) {
    return false;
  }
  if (typeof password !== 'string' || password.length === 0) {
    return false;
  }
  if (!authorization || !authorization.startsWith('Basic ')) {
    return false;
  }
  const decoded = Buffer.from(authorization.slice('Basic '.length).trim(), 'base64').toString('utf8');
  const splitAt = decoded.indexOf(':');
  if (splitAt < 0) {
    return false;
  }
  return sameText(decoded.slice(0, splitAt), user) && sameText(decoded.slice(splitAt + 1), password);
}

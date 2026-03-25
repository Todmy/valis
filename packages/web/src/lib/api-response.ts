/**
 * T004: Shared API response helpers.
 *
 * All API routes return JSON via NextResponse. These helpers ensure
 * consistent response shapes and status codes.
 */

import { NextResponse } from 'next/server';

export function jsonResponse(body: unknown, status: number): NextResponse {
  return NextResponse.json(body, { status });
}

export function unauthorized(message?: string): NextResponse {
  return NextResponse.json({ error: message ?? 'unauthorized' }, { status: 401 });
}

export function forbidden(message: string): NextResponse {
  return NextResponse.json({ error: message }, { status: 403 });
}

export function badRequest(message: string): NextResponse {
  return NextResponse.json({ error: message }, { status: 400 });
}

export function notFound(message: string): NextResponse {
  return NextResponse.json({ error: message }, { status: 404 });
}

export function serverError(message: string): NextResponse {
  return NextResponse.json({ error: message }, { status: 500 });
}

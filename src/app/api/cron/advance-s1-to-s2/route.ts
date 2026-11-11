import { NextResponse } from 'next/server';

export function GET() {
  return new NextResponse(null, { status: 404 });
}

export function POST() {
  return new NextResponse(null, { status: 404 });
}

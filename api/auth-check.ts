// Simple password check endpoint
export default async function handler(req: Request) {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const { password } = await req.json();
  const adminPassword = process.env.ADMIN_PASSWORD;

  if (!adminPassword) {
    return new Response('Server not configured', { status: 500 });
  }

  if (password === adminPassword) {
    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response('Unauthorized', { status: 401 });
}

export const config = { runtime: 'edge' };

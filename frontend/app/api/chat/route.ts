import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { messages } = body;

    // Use API_URL (server-side env var) which works at runtime
    // For local dev, falls back to localhost
    // For Railway, use the private network URL
    const apiUrl = process.env.API_URL ||
                   process.env.NEXT_PUBLIC_API_URL ||
                   'http://localhost:4111';

    console.log('=== Chat API Route Debug ===');
    console.log('API_URL env var:', process.env.API_URL);
    console.log('NEXT_PUBLIC_API_URL env var:', process.env.NEXT_PUBLIC_API_URL);
    console.log('Final apiUrl:', apiUrl);
    console.log('Full URL:', `${apiUrl}/api/agents/insuranceAgent/generate`);
    console.log('Messages count:', messages?.length);

    // Add API key for authentication
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    // Add API key if configured
    if (process.env.MASTRA_API_KEY) {
      headers['x-api-key'] = process.env.MASTRA_API_KEY;
    }

    const response = await fetch(`${apiUrl}/api/agents/insuranceAgent/generate`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ messages }),
    });

    console.log('Response status:', response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('API error response:', errorText);
      return NextResponse.json(
        { error: 'Failed to get response from assistant', details: errorText, status: response.status },
        { status: response.status }
      );
    }

    const data = await response.json();
    console.log('Success! Response received');
    return NextResponse.json(data);
  } catch (error) {
    console.error('Error in chat API route:', error);
    console.error('Error stack:', error instanceof Error ? error.stack : 'No stack');
    return NextResponse.json(
      {
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined
      },
      { status: 500 }
    );
  }
}

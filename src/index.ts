import { Hono } from 'hono';

export interface Env {
  findteu_db: D1Database;
  WEBHOOK_API_KEY: string;
  TAURI_API_KEY: string;
}

const app = new Hono<{ Bindings: Env }>();

// Webhook endpoint for findTEU
app.post('/webhook/findteu', async (c) => {
  // Validate FindTEU API Key
  const apiKey = c.req.header('X-Authorization-ApiKey');
  if (apiKey !== c.env.WEBHOOK_API_KEY) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  try {
    const payload = await c.req.json();
    
    // We assume the payload contains the container number.
    // Given we don't have the exact schema, we fallback to common property names
    const containerNumber = payload.containerNumber || payload.container_number || payload.number || payload.id;
    
    if (!containerNumber) {
      return c.json({ error: 'Missing container number in payload' }, 400);
    }
    
    const status = payload.status || payload.currentStatus || 'UNKNOWN';
    const payloadStr = JSON.stringify(payload);

    // Check if the container already exists
    const existing = await c.env.findteu_db
      .prepare('SELECT * FROM containers WHERE container_number = ?')
      .bind(containerNumber)
      .first();

    if (!existing) {
      // First time seeing this container
      await c.env.findteu_db
        .prepare(`
          INSERT INTO containers (container_number, status, first_data, latest_data)
          VALUES (?, ?, ?, ?)
        `)
        .bind(containerNumber, status, payloadStr, payloadStr)
        .run();
    } else {
      // Container exists, update the latest_data and status
      await c.env.findteu_db
        .prepare(`
          UPDATE containers 
          SET status = ?, latest_data = ?, updated_at = CURRENT_TIMESTAMP
          WHERE container_number = ?
        `)
        .bind(status, payloadStr, containerNumber)
        .run();
    }

    return c.json({ success: true, message: 'Webhook received and processed' });
  } catch (error: any) {
    console.error('Error processing webhook:', error);
    return c.json({ error: 'Internal Server Error' }, 500);
  }
});

// API for local Tauri App to get all containers
app.get('/api/containers', async (c) => {
  // Validate Tauri API Key
  const apiKey = c.req.header('x-api-key');
  if (apiKey !== c.env.TAURI_API_KEY) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  try {
    const { results } = await c.env.findteu_db
      .prepare('SELECT * FROM containers ORDER BY updated_at DESC')
      .all();
      
    // Parse the JSON strings back into objects for the API response
    const containers = results.map((row: any) => {
      let first_data, latest_data;
      try { first_data = JSON.parse(row.first_data); } catch (e) { first_data = row.first_data; }
      try { latest_data = JSON.parse(row.latest_data); } catch (e) { latest_data = row.latest_data; }

      return {
        container_number: row.container_number,
        status: row.status,
        created_at: row.created_at,
        updated_at: row.updated_at,
        first_data,
        latest_data
      };
    });

    return c.json({ containers });
  } catch (error: any) {
    console.error('Error fetching containers:', error);
    return c.json({ error: 'Internal Server Error' }, 500);
  }
});

// API for local Tauri App to get a specific container
app.get('/api/containers/:number', async (c) => {
  const apiKey = c.req.header('x-api-key');
  if (apiKey !== c.env.TAURI_API_KEY) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const number = c.req.param('number');
  
  try {
    const container = await c.env.findteu_db
      .prepare('SELECT * FROM containers WHERE container_number = ?')
      .bind(number)
      .first();

    if (!container) {
      return c.json({ error: 'Container not found' }, 404);
    }
    
    // Parse JSON strings
    let first_data, latest_data;
    try { first_data = JSON.parse(container.first_data as string); } catch (e) { first_data = container.first_data; }
    try { latest_data = JSON.parse(container.latest_data as string); } catch (e) { latest_data = container.latest_data; }

    const result = {
      container_number: container.container_number,
      status: container.status,
      created_at: container.created_at,
      updated_at: container.updated_at,
      first_data,
      latest_data
    };

    return c.json(result);
  } catch (error: any) {
    console.error(`Error fetching container ${number}:`, error);
    return c.json({ error: 'Internal Server Error' }, 500);
  }
});

// API for local Tauri App to initiate tracking for a new container on findTEU
app.post('/api/containers/:number/track', async (c) => {
  const apiKey = c.req.header('x-api-key');
  if (apiKey !== c.env.TAURI_API_KEY) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const number = c.req.param('number');
  
  try {
    const params = new URLSearchParams();
    params.append('use_webhook', 'true');

    const response = await fetch(`https://api.findteu.com/container/${number}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-Authorization-ApiKey': c.env.WEBHOOK_API_KEY
      },
      body: params.toString()
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`FindTEU API error for ${number}:`, errorText);
      return c.json({ error: 'Failed to add tracking on FindTEU', details: errorText }, response.status as any);
    }

    const data = await response.json();
    
    return c.json({ 
      success: true, 
      message: `Tracking initiated for container ${number}. Webhook will receive updates shortly.`, 
      findteu_response: data 
    });
  } catch (error: any) {
    console.error(`Error initiating tracking for container ${number}:`, error);
    return c.json({ error: 'Internal Server Error' }, 500);
  }
});

export default app;

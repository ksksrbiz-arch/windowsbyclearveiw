const MAX = {
  name: 120,
  phone: 40,
  email: 160,
  city: 80,
  notes: 2000,
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

function clean(value, max) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

export async function onRequestPost(context) {
  let form;
  try {
    form = await context.request.formData();
  } catch {
    return json({ error: 'Send the form as multipart data.' }, 400);
  }

  const lead = {
    name: clean(form.get('name'), MAX.name),
    phone: clean(form.get('phone'), MAX.phone),
    email: clean(form.get('email'), MAX.email),
    city: clean(form.get('city'), MAX.city),
    notes: clean(form.get('notes'), MAX.notes),
  };

  if (!lead.name || !lead.phone || !lead.city) {
    return json({ error: 'Name, phone, and city are required.' }, 400);
  }

  console.log('estimate-request', { ...lead, receivedAt: new Date().toISOString() });
  return json({ ok: true });
}

export async function onRequestGet() {
  return json({ error: 'POST a request from the estimate form.' }, 405);
}

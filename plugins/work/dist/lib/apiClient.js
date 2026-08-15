export async function callElowenApi(method, path, body, opts) {
    const f = opts.fetchImpl ?? fetch;
    const m = method.toUpperCase();
    const headers = { authorization: `Bearer ${opts.token}` };
    const hasBody = body !== undefined && m !== 'GET' && m !== 'HEAD';
    if (hasBody)
        headers['content-type'] = 'application/json';
    const res = await f(`${opts.url}${path.startsWith('/') ? path : `/${path}`}`, {
        method: m,
        headers,
        body: hasBody ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let data;
    try {
        data = text ? JSON.parse(text) : undefined;
    }
    catch {
        data = undefined;
    }
    return { status: res.status, ok: res.ok, data, text };
}

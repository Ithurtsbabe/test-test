// api/proxy.js

// Tell Vercel this is an Edge Function
export const config = {
  runtime: "edge",
};

export default async function handler(request) {
  const url = new URL(request.url);

  // Forward same path + query to your VPS origin
  //const upstreamUrl = `https://za2.zeitvpn.com${url.pathname}${url.search}`;
  const upstreamUrl = `${import.meta.env.TARGET_DOMAIN}${url.pathname}${url.search}`;

  // Copy headers, skip forbidden ones
  const forwardHeaders = new Headers();
  for (const [k, v] of request.headers) {
    const kl = k.toLowerCase();
    if (["host","connection","keep-alive","proxy-connection","transfer-encoding"].includes(kl)) continue;
    forwardHeaders.set(k, v);
  }
  forwardHeaders.set("x-forwarded-host", url.host);
  forwardHeaders.set("x-forwarded-proto", url.protocol.replace(":", ""));

  // Fetch from origin
  const upstreamRes = await fetch(upstreamUrl, {
    method: request.method,
    headers: forwardHeaders,
    body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
    redirect: "manual",
  });

  // Copy response headers, add cache & CORS
  const resHeaders = new Headers(upstreamRes.headers);
  resHeaders.set("Cache-Control", "public, max-age=60, s-maxage=60");
  resHeaders.set("Access-Control-Allow-Origin", "*");

  return new Response(upstreamRes.body, {
    status: upstreamRes.status,
    headers: resHeaders,
  });
}

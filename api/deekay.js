// api/deekay.js

export const config = {
  runtime: "edge",
};

// Hardcoded target domain.
// No trailing slash.
const TARGET_DOMAIN = "http://germany02.connection-checker.com";

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "host",
  "content-length",
]);

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS,HEAD",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Max-Age": "86400",
};

function cleanTargetDomain(domain) {
  return domain.endsWith("/") ? domain.slice(0, -1) : domain;
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...CORS_HEADERS,
    },
  });
}

function buildForwardHeaders(request, currentUrl) {
  const headers = new Headers();

  for (const [key, value] of request.headers.entries()) {
    const lower = key.toLowerCase();

    if (HOP_BY_HOP_HEADERS.has(lower)) {
      continue;
    }

    headers.set(key, value);
  }

  headers.set("x-forwarded-host", currentUrl.host);
  headers.set("x-forwarded-proto", currentUrl.protocol.replace(":", ""));

  // Do NOT manually set Host on Vercel Edge.
  // fetch() will set the correct Host based on TARGET_DOMAIN.

  return headers;
}

function buildResponseHeaders(upstreamRes, currentUrl, targetDomain) {
  const headers = new Headers();

  for (const [key, value] of upstreamRes.headers.entries()) {
    const lower = key.toLowerCase();

    if (HOP_BY_HOP_HEADERS.has(lower)) {
      continue;
    }

    if (lower === "access-control-allow-origin") {
      continue;
    }

    headers.set(key, value);
  }

  for (const [key, value] of Object.entries(CORS_HEADERS)) {
    headers.set(key, value);
  }

  const location = upstreamRes.headers.get("location");

  if (location) {
    try {
      const targetOrigin = new URL(targetDomain).origin;
      const rewritten = new URL(location, targetDomain);

      if (rewritten.origin === targetOrigin) {
        rewritten.protocol = currentUrl.protocol;
        rewritten.host = currentUrl.host;
        headers.set("location", rewritten.toString());
      } else {
        headers.set("location", location);
      }
    } catch {
      headers.set("location", location);
    }
  }

  if (!headers.has("cache-control")) {
    headers.set("Cache-Control", "no-store");
  }

  return headers;
}

export default async function handler(request) {
  const currentUrl = new URL(request.url);
  const targetDomain = cleanTargetDomain(TARGET_DOMAIN);

  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: CORS_HEADERS,
    });
  }

  let targetUrl;

  try {
    targetUrl = new URL(
      `${currentUrl.pathname}${currentUrl.search}`,
      targetDomain
    );
  } catch {
    return jsonResponse(
      {
        status: "error",
        message: "Invalid hardcoded TARGET_DOMAIN.",
        target_domain: targetDomain,
      },
      500
    );
  }

  // Debug endpoint:
  // Visit: https://your-vercel-domain.vercel.app/__debug
  if (currentUrl.pathname === "/__debug") {
    try {
      const debugUrl = new URL("/", targetDomain);

      const debugRes = await fetch(debugUrl.toString(), {
        method: "GET",
        redirect: "manual",
      });

      const debugBody = await debugRes.text();

      return jsonResponse({
        status: "success",
        target: debugUrl.toString(),
        upstream_status: debugRes.status,
        upstream_status_text: debugRes.statusText,
        upstream_headers: Object.fromEntries(debugRes.headers.entries()),
        upstream_body_preview: debugBody.slice(0, 1500),
      });
    } catch (error) {
      return jsonResponse(
        {
          status: "error",
          message: "Debug fetch failed.",
          target: targetDomain,
          error_name: error?.name || null,
          error_message: error?.message || String(error),
          error_stack: error?.stack || null,
        },
        502
      );
    }
  }

  const forwardHeaders = buildForwardHeaders(request, currentUrl);

  try {
    const upstreamRes = await fetch(targetUrl.toString(), {
      method: request.method,
      headers: forwardHeaders,
      body:
        request.method === "GET" || request.method === "HEAD"
          ? undefined
          : request.body,
      redirect: "manual",
    });

    const responseHeaders = buildResponseHeaders(
      upstreamRes,
      currentUrl,
      targetDomain
    );

    if (
      ["GET", "HEAD"].includes(request.method) &&
      upstreamRes.status >= 200 &&
      upstreamRes.status < 400
    ) {
      responseHeaders.set(
        "Cache-Control",
        "public, max-age=60, s-maxage=60, stale-while-revalidate=300"
      );
    }

    return new Response(upstreamRes.body, {
      status: upstreamRes.status,
      statusText: upstreamRes.statusText,
      headers: responseHeaders,
    });
  } catch (error) {
    return jsonResponse(
      {
        status: "error",
        message: "Failed to fetch upstream origin.",
        target: targetUrl?.toString() || null,
        method: request.method,
        error_name: error?.name || null,
        error_message: error?.message || String(error),
        error_stack: error?.stack || null,
        hint: "This means Vercel could not reach the origin, the origin closed the connection, or the response type is not supported by Vercel Edge.",
      },
      502
    );
  }
}

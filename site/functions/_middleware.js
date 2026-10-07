// One home for search engines: the pages.dev address redirects (301) to subswap.tanookistudios.com,
// and preview deployments (<hash>.subswap-site.pages.dev) are kept out of search results.
export async function onRequest({ request, next }) {
  const url = new URL(request.url);
  if (url.hostname === "subswap-site.pages.dev") {
    url.hostname = "subswap.tanookistudios.com"; url.protocol = "https:"; url.port = "";
    return Response.redirect(url.toString(), 301);
  }
  const res = await next();
  if (url.hostname.endsWith(".pages.dev")) {
    const r = new Response(res.body, res);
    r.headers.set("X-Robots-Tag", "noindex");
    return r;
  }
  return res;
}

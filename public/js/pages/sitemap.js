// Human-readable sitemap. The list is static HTML generated from
// server/config/site-routes.js by scripts/build.js; this module only adds the
// signed-in area links' state.
import { definePage } from '../core/page.js';

definePage({
  id: 'sitemap',
  area: 'public',
  namespaces: ['public'],
  title: 'public:sitemap.metaTitle',
  render({ page, user }) {
    page.querySelectorAll('[data-requires="admin"]').forEach((el) => {
      el.hidden = !user?.roles?.length;
    });
  },
});

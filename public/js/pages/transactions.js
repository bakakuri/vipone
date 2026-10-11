// Complete transaction history from the ledger, with filters, CSV export and
// the debit/credit entries behind each line.
import { publicApi } from '../api/endpoints.js';
import { definePage } from '../core/page.js';
import { replace } from '../core/dom.js';
import { registerAssets } from '../formatting/format-currency.js';
import { t } from '../i18n/i18n.js';
import { pageHeader } from '../components/misc/page-header.js';
import { helpButton } from '../components/onboarding/help-drawer.js';
import { transactionHistory } from '../components/tables/transaction-history.js';

definePage({
  id: 'transactions',
  area: 'app',
  namespaces: ['transactions'],
  title: 'transactions:title',
  async render({ page }) {
    const assets = await publicApi.assets();
    registerAssets(assets);
    const history = transactionHistory({ assets });
    replace(page,
      pageHeader({ title: t('transactions:title'), subtitle: t('transactions:subtitle'), actions: [helpButton('transactions'), history.exportButton] }),
      history.el);
    await history.load();
  },
});

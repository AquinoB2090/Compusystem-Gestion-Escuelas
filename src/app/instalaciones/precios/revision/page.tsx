import { requireInstallationRole } from '../../access';
import PriceReview from './price-review';

export default async function RevisionPage() {
  await requireInstallationRole(['admin']);
  return <PriceReview />;
}

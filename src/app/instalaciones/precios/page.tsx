import { requireInstallationRole } from '../access';
import PricesCatalog from './prices-catalog';

export default async function PreciosPage() {
  await requireInstallationRole();
  return <PricesCatalog />;
}

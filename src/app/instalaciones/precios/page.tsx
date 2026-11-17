import { requireInstallationRole } from '../access';
import PricesCatalog from './prices-catalog';

export default async function PreciosPage() {
  const { profile } = await requireInstallationRole();
  return <PricesCatalog role={profile.rol} />;
}

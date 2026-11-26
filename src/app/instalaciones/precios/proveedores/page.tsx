import { requireInstallationRole } from '../../access';
import ProvidersManager from './providers-manager';

export default async function ProveedoresPage() {
  await requireInstallationRole(['admin']);
  return <ProvidersManager />;
}

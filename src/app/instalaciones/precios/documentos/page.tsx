import { requireInstallationRole } from '../../access';
import DocumentsInbox from './documents-inbox';

export default async function DocumentosPage() {
  await requireInstallationRole(['admin']);
  return <DocumentsInbox />;
}

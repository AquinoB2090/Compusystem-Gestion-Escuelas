import { requireInstallationRole } from '../access';
import QuoteAssistant from './quote-assistant';

export default async function CotizacionesPage() {
  const { profile } = await requireInstallationRole();
  return <QuoteAssistant salesperson={profile.nombre} />;
}

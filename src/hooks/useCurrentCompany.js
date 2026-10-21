import { useAuth } from '../context/AuthContext';
import { useData } from '../context/DataContext';

/**
 * useCurrentCompany()
 * ---------------------------------------------------------------------------
 * The recruiter equivalent of useCurrentStudent(): returns the full company
 * document of the logged-in recruiter, so the company dashboard can filter
 * drives and applicants by `company.id`.
 */
export function useCurrentCompany() {
  const { user } = useAuth();
  const { companies } = useData();

  if (!user || user.role !== 'company') return null;
  return companies.find((company) => company.id === user.id) || null;
}

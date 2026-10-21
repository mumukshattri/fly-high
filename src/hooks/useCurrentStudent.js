import { useAuth } from '../context/AuthContext';
import { useData } from '../context/DataContext';

/**
 * useCurrentStudent()
 * ---------------------------------------------------------------------------
 * A custom hook that combines the two contexts we need and returns the FULL
 * student profile (CGPA, branch, skills, resume...) of the logged-in user.
 *
 * Why a custom hook? Because otherwise every student page would repeat:
 *
 *   const { user } = useAuth();
 *   const { students } = useData();
 *   const student = students.find(s => s.id === user.id);
 *
 * Custom hooks are just normal functions that may use other hooks - React lets
 * us share stateful logic this way. It also returns the updated profile
 * immediately after the student saves an edit, because it reads from
 * DataContext which is refreshed after every write.
 */
export function useCurrentStudent() {
  const { user } = useAuth();
  const { students } = useData();

  if (!user || user.role !== 'student') return null;
  return students.find((student) => student.id === user.id) || null;
}

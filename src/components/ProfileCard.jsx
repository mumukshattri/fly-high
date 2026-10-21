import Avatar from './Avatar';
import Icon from './Icon';
import Progress from './Progress';
import { getProfileCompletion } from '../utils/profileCompletion';

/**
 * components/ProfileCard.jsx
 * ---------------------------------------------------------------------------
 * The "Profile Summary" card on the student dashboard: who you are, your
 * academic facts, and how complete your profile is.
 *
 * The completion percentage is NOT hardcoded - it is calculated by
 * utils/profileCompletion.js from the actual student object, so it goes up as
 * soon as the student fills in a field on the profile page.
 */
export default function ProfileCard({ student, onViewProfile }) {
  if (!student) return null;

  const completion = getProfileCompletion(student);

  return (
    <section className="card card--pad">
      <div className="profile-card__head">
        <Avatar name={student.name} size="lg" />
        <div className="grow">
          <div className="profile-card__name">{student.name}</div>
          <div className="profile-card__sub">{student.email}</div>
          <div className="row gap-4 mt-8 wrap">
            <span className="badge badge--info">{student.branch}</span>
            <span className="badge badge--neutral">Sem {student.semester}</span>
            <span className="badge badge--neutral">{student.rollNumber}</span>
          </div>
        </div>
      </div>

      <div className="profile-card__facts">
        <div>
          <div className="profile-card__fact-label">Branch</div>
          <div className="profile-card__fact-value">{student.branch}</div>
        </div>
        <div>
          <div className="profile-card__fact-label">CGPA</div>
          <div className="profile-card__fact-value">{student.cgpa}</div>
        </div>
        <div>
          <div className="profile-card__fact-label">Skills</div>
          <div className="profile-card__fact-value">
            {(student.skills || []).slice(0, 3).join(', ') || 'Not added'}
          </div>
        </div>
        <div>
          <div className="profile-card__fact-label">Graduation</div>
          <div className="profile-card__fact-value">{student.graduationYear}</div>
        </div>
      </div>

      <div className="completion">
        <div className="completion__head">
          <span className="completion__label">Profile completion</span>
          <span className="completion__value">{completion.percent}%</span>
        </div>
        <Progress value={completion.percent} />
        <p className="completion__hint">
          {completion.missing.length === 0
            ? 'Your profile is complete. Companies can see all your details.'
            : `Still to add: ${completion.missing.slice(0, 2).join(', ')}${
                completion.missing.length > 2 ? ` +${completion.missing.length - 2} more` : ''
              }`}
        </p>
      </div>

      <button type="button" className="btn btn--outline btn--block mt-16" onClick={onViewProfile}>
        <Icon name="user" size={16} />
        View Profile
      </button>
    </section>
  );
}

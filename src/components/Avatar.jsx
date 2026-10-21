import { initials } from '../utils/format';

/**
 * components/Avatar.jsx
 * ---------------------------------------------------------------------------
 * Shows a person's initials. We do not use photos in a campus portal, so an
 * initials avatar avoids broken image placeholders and looks consistent.
 */
export default function Avatar({ name = '', size = 'md', square = false, className = '' }) {
  const classes = [
    'avatar',
    size === 'lg' ? 'avatar--lg' : '',
    size === 'sm' ? 'avatar--sm' : '',
    square ? 'avatar--round' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={classes} title={name}>
      {initials(name) || '?'}
    </div>
  );
}

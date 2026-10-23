import { Link } from 'react-router-dom';
import lightLogo from '../assets/mainlogo.png';

export default function TeacherBrand() {
  return <Link to="/teacher/dashboard" className="teacher-brand-link" aria-label="My JEE Mentor home">
    <span className="teacher-brand-frame">
      <img className="teacher-brand-full" src={lightLogo} alt="My JEE Mentor" width="2176" height="570" />
      <img className="teacher-brand-mark" src={lightLogo} alt="" aria-hidden="true" width="570" height="570" />
    </span>
  </Link>;
}

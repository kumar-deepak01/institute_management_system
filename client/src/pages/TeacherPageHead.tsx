import { Helmet } from 'react-helmet-async';

export default function TeacherPageHead({ title, description }: { title: string; description: string }) {
  return <Helmet>
    <title>{title} | Teacher Portal</title>
    <meta name="description" content={description} />
  </Helmet>;
}

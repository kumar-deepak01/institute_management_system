import { Helmet } from 'react-helmet-async';

export default function StudentPageHead({ title, description }: { title: string; description: string }) {
  return <Helmet>
    <title>{title} | Student Portal</title>
    <meta name="description" content={description} />
  </Helmet>;
}

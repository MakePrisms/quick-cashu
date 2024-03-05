// pages/api/users/[slug].ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { deleteUser, findUserByPubkey, updateUser } from '@/lib/userModels';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { slug } = req.query;

  switch (req.method) {
    case 'GET':
      try {
        if (!slug || typeof slug !== 'string') {
            return res.status(400).json({ message: 'Invalid slug' });
            }

        const user = await findUserByPubkey(slug.toString());
        if (user) {
          return res.status(200).json(user);
        } else {
          return res.status(404).json({ message: 'User not found' });
        }
      } catch (error: any) {
        return res.status(500).json({ message: error.message });
      }

    case 'PUT':
      try {
        const { pubkey, username } = req.body;
        const updatedUser = await updateUser(pubkey, { username });
        return res.status(200).json(updatedUser);
      } catch (error: any) {
        return res.status(500).json({ message: error.message });
      }

    case 'DELETE':
      try {
        await deleteUser(Number(slug));
        return res.status(204).end();
      } catch (error: any) {
        return res.status(500).json({ message: error.message });
      }

    default:
      res.setHeader('Allow', ['GET', 'PUT', 'DELETE']);
      res.status(405).end(`Method ${req.method} Not Allowed`);
  }
}

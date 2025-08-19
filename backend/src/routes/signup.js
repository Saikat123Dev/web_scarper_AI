import { PrismaClient } from '@prisma/client';
import { Router } from 'express';
import { OAuth2Client } from 'google-auth-library';
import jwt from 'jsonwebtoken';

const prisma = new PrismaClient();
const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

const router = Router();
router.post('/auth/google', async (req, res) => {
  try {
    const { token } = req.body;
    const ticket = await client.verifyIdToken({
      idToken: token,
      audience: process.env.GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    const { sub: googleId, email, name, picture } = payload;
    let user = await prisma.user.findUnique({
      where: { email }
    });

    if (!user) {

      user = await prisma.user.create({
        data: {
          email,
          name,
          googleId,
          avatar: picture,
          provider: 'google'
        }
      });
    } else {

      user = await prisma.user.update({
        where: { id: user.id },
        data: {
          googleId: googleId,
          avatar: picture || user.avatar,
          name: name || user.name
        }
      });
    }


    const jwtToken = jwt.sign(
      { userId: user.id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        avatar: user.avatar
      },
      token: jwtToken
    });

  } catch (error) {
    console.error('Google auth error:', error);
    res.status(400).json({
      success: false,
      message: 'Authentication failed'
    });
  }
});

export default router;

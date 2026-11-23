// must call this middleware after verifyToken
export const verifyStudent = async (req, res, next) => {
  if (req.user.role !== 'student') {
    res.status(403).send({ message: 'Forbidden' });
    return;
  }
  next();
}

export const verifyTutor = async (req, res, next) => {
  if (req.user.role !== 'tutor') {
    res.status(403).send({ message: 'Forbidden' });
    return;
  }
  next();
}

export const verifyAdmin = async (req, res, next) => {
  if (req.user.role !== 'admin') {
    res.status(403).send({ message: 'Forbidden' });
    return;
  }
  next();
}

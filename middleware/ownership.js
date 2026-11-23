import { ObjectId } from "mongodb";

export const validateId = (req, res, next) => {
  if (!ObjectId.isValid(req.params.id)) {
    return res.status(400).send({ message: "Invalid ID" })
  }
  next()
}

export const requireOwnId = (param) => (req, res, next) => {
  if (req.params[param] !== req.user._id.toString()) {
    return res.status(403).send({ message: "Forbidden" })
  }
  next()
}

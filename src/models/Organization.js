import mongoose from 'mongoose';

const organizationSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    orgName: {
      type: String,
      required: true,
    },
    type: {
      type: String,
      enum: ['gym', 'clinic', 'corporate'],
      required: true,
    },
    location: String,
    status: {
      type: String,
      enum: ['active', 'inactive'],
      default: 'active',
    },
  },
  { timestamps: true }
);

export default mongoose.model('Organization', organizationSchema);

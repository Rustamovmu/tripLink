import { Schema } from 'mongoose';

const CategorySchema = new Schema(
	{
		categoryName: { type: String, required: true, unique: true, trim: true },
		categorySlug: { type: String, required: true, unique: true, lowercase: true, trim: true },
		categoryDescription: { type: String, trim: true },
		categoryImage: { type: String },
		categoryActive: { type: Boolean, default: true },
		categoryOrder: { type: Number, default: 0 },
	},
	{ timestamps: true, collection: 'categories' },
);

CategorySchema.index({ categoryActive: 1, categoryOrder: 1 });

export default CategorySchema;

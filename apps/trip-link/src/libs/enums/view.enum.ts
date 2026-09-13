import { registerEnumType } from '@nestjs/graphql';

export enum ViewGroup {
	MEMBER = 'MEMBER',
	ARTICLE = 'ARTICLE',
	TOUR = 'TOUR',
}
registerEnumType(ViewGroup, {
	name: 'ViewGroup',
});

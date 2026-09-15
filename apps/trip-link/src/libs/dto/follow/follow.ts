import { Field, ObjectType } from '@nestjs/graphql';
import { Member } from '../member/member';

@ObjectType()
export class FollowToggleResult {
	@Field(() => Member)
	member!: Member;

	@Field(() => Boolean)
	followed!: boolean;
}

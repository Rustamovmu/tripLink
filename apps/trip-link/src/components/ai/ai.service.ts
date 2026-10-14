import { Injectable } from '@nestjs/common';
import { GraphQLError } from 'graphql';
import { AiChatInput } from '../../libs/dto/ai/ai-chat.input';
import { AiChatResult, AiTourSource } from '../../libs/dto/ai/ai-chat';
import type { Tour } from '../../libs/dto/tour/tour';
import { Direction } from '../../libs/enums/common.enum';
import { TourService } from '../tour/tour.service';
import { AiRateLimitService } from './ai-rate-limit.service';
import { GeminiProvider } from './gemini.provider';
import { AI_HISTORY_LIMIT, AI_TOUR_LIMIT } from './ai.constants';

@Injectable()
export class AiService {
	constructor(
		private readonly tours: TourService,
		private readonly limits: AiRateLimitService,
		private readonly gemini: GeminiProvider,
	) {}

	async chat(memberId: string, input: AiChatInput): Promise<AiChatResult> {
		let release: (() => Promise<void>) | undefined;
		try {
			release = await this.limits.reserve(memberId);
			const tours = input.tourId
				? [await this.tours.getTour(input.tourId)] // No viewer: AI questions never increment visit counters.
				: (
						await this.tours.getTours({
							page: 1,
							limit: AI_TOUR_LIMIT,
							search: this.search(input),
							sort:
								input.intent === 'BEST_RATED' ||
								/best.rated|highest.rated|평점|рейтинг|eng yuqori baho/iu.test(input.message)
									? 'tourAverageRating'
									: input.intent === 'POPULAR_DESTINATIONS' || /popular|인기|популяр|ommabop/iu.test(input.message)
										? 'tourBookingCount'
										: 'createdAt',
							direction: Direction.DESC,
						})
					).list;
			const sources: AiTourSource[] = tours.map((tour) => ({
				tourId:
					typeof (tour._id as unknown) === 'string'
						? (tour._id as unknown as string)
						: (tour._id as unknown as { toHexString(): string }).toHexString(),
				title: tour.tourTitle,
				destination: tour.tourDestination,
				price: tour.tourDiscountPrice ?? tour.tourPrice,
				durationDays: tour.tourDurationDays,
				rating: tour.tourAverageRating,
				reviewCount: tour.tourReviewCount,
				status: tour.tourStatus,
			}));
			const catalogue = JSON.stringify({
				partialCatalogue: !input.tourId,
				tours: tours.map((tour, i) => this.compact(tour, sources[i])),
			});
			const history = (input.history ?? []).slice(-AI_HISTORY_LIMIT);
			// Gemini history begins with a user turn. Adjacent same-role turns are accepted.
			while (history[0]?.role === 'assistant') history.shift();
			const text = await this.gemini.generate(
				[...history, { role: 'user', text: input.message }],
				catalogue,
				input.detailed === true ||
					/in detail|detailed explanation|자세히|자세한 설명|подробно|подробное объяснение|batafsil/iu.test(
						input.message,
					),
				input.locale,
			);
			return { text, sources };
		} catch (error: unknown) {
			if (
				error instanceof GraphQLError &&
				['AI_RATE_LIMITED', 'AI_UNAVAILABLE'].includes(String(error.extensions.code))
			)
				throw error;
			throw new GraphQLError('AI assistance is temporarily unavailable. Please retry.', {
				extensions: { code: 'AI_UNAVAILABLE' },
			});
		} finally {
			// A failed cleanup cannot hide a completed response; TTL releases stale leases.
			if (release) await release().catch(() => undefined);
		}
	}

	private search(input: AiChatInput) {
		if (input.search && Object.keys(input.search).length) return input.search;
		const featured = /featured|추천 투어|추천투어|избранные туры|tavsiya etilgan/iu.test(input.message);
		// Simple multilingual keyword retrieval; no extra Gemini call. Explicit page
		// filters take precedence. Unknown language terms may return an empty catalogue.
		if (input.intent) return featured ? { featured: true } : {};
		const aliases: [RegExp, string][] = [
			[/한국|대한민국|коре[яиюе]|koreya(?:ga|da|dagi|ni)?/giu, ' Korea '],
			[/서울|сеул[ае]?|seul(?:ga|da|dagi|ni)?/giu, ' Seoul '],
			[/제주|чеджу|jeju(?:ga|da|dagi|ni)?/giu, ' Jeju '],
			[/부산|пусан[ае]?|busan(?:ga|da|dagi|ni)?/giu, ' Busan '],
		];
		const stop = new Set(
			(
				'find show help me i my want would like please a an the in on at to for and or of is are can could what which where how much more tell about tour tours trip travel plan planning destination destinations popular best rated highest featured package packages prices price recommendation recommendations recommend booking book availability available days day ' +
				'여행 투어 추천 알려주세요 보여주세요 도와주세요 계획 평점 가장 높은 인기 찾고 싶어요 에서 의 는 은 를 을 ' +
				'sayohat sayohatlar sayohatlarni safar safarlar top toping topishga yordam bering menga ko‘rsating korsating reja rejalashtirishga ommabop eng yuqori baholangan haqida batafsil narx narxlar kun kunlar manzil manzillar manzillarini band qilish tavsiya etilgan ' +
				'туры тур путешествие поездку поездки помогите покажите мне лучшие лучших популярные направления в на о и как где сколько подробнее'
			).split(/\s+/u),
		);
		for (const message of [
			input.message,
			...(input.history ?? [])
				.filter((entry) => entry.role === 'user')
				.map((entry) => entry.text)
				.reverse(),
		]) {
			let query = message;
			for (const [pattern, replacement] of aliases) query = query.replace(pattern, replacement);
			const tokens: string[] = query.match(/[\p{L}\p{N}]+/gu) ?? [];
			const words = tokens.filter((word) => !stop.has(word.toLowerCase()));
			if (words.length)
				return { text: words.slice(0, 8).join(' ').slice(0, 150), ...(featured ? { featured: true } : {}) };
		}
		return featured ? { featured: true } : {};
	}

	private compact(tour: Tour, source: AiTourSource) {
		const now = Date.now();
		const short = (value: string) => value.slice(0, 180);
		return {
			...source,
			country: tour.tourCountry,
			city: tour.tourCity,
			description: tour.tourDescription.slice(0, 360),
			category: tour.tourCategory,
			difficulty: tour.tourDifficulty,
			bookingCount: tour.tourBookingCount,
			languages: tour.tourLanguages.slice(0, 3).map(short),
			included: tour.tourIncludedServices.slice(0, 3).map(short),
			excluded: tour.tourExcludedServices.slice(0, 3).map(short),
			accommodation: tour.tourAccommodation?.slice(0, 180),
			departures: tour.tourAvailableDates
				.filter((date) => new Date(date.startDate).getTime() > now)
				.slice(0, 3)
				.map((date) => ({
					start: date.startDate,
					end: date.endDate,
					seats: date.availableSeats,
				})),
		};
	}
}

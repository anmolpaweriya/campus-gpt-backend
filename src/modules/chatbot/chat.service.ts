// src/chat/chat.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import axios from 'axios';
import { DbService } from 'src/core/services/db-service/db.service';
import { ChatHistoryModel, ChatMessageModel } from './chat.schema';
import { CreateChatSessionDto } from './chat.dto';
import { ASSISTANCE_GREETING, INITIAL_MODEL_DATA } from './chat.constants';
import { CourseService } from '../courses/courses.services';
import { FacultyService } from '../faculty/faculty.services';
import { BuildingService } from '../building/building.service';
import * as pdfParse from 'pdf-parse';
import { EventService } from '../events/events.services';

@Injectable()
export class ChatService {
  private readonly OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
  private readonly OPENROUTER_MODEL = process.env.OPENROUTER_MODEL;
  private readonly OPENROUTER_URL = process.env.OPENROUTER_URL!;
  private readonly ChatMessageModel: typeof ChatMessageModel;
  private readonly ChatHistoryModel: typeof ChatHistoryModel;
  constructor(
    private readonly dbService: DbService,
    private readonly courseService: CourseService,
    private readonly facultyService: FacultyService,
    private readonly buildingService: BuildingService,
    private readonly eventService: EventService,
  ) {
    this.ChatMessageModel = this.dbService.sqlService.ChatMessageModel;
    this.ChatHistoryModel = this.dbService.sqlService.ChatHistoryModel;
  }

  private async getModelTrainingData(userId: string) {
    const data = [
      ...INITIAL_MODEL_DATA.map((content) => ({
        role: 'system',
        content,
      })),
    ];
    try {
<<<<<<< HEAD
      const course = await this.courseService.getUserCourse(userId);
      data.push({
        role: 'system',
        content: `I am enrolled in this course: ${JSON.stringify(course)}`,
      });
    } catch (err) {
      console.log(err);
    }

    const faculties = await this.facultyService.findAll();
    data.push({
      role: 'system',
      content: `these are my universities faculties : ${JSON.stringify(faculties)}`,
=======
      const response = await axios.post(
        this.OPENROUTER_URL,
        {
          model: this.OPENROUTER_MODEL,
          messages: [
            {
              role: 'system',
              content:
                'You are an expert conversation title generator. Output ONLY a concise, professional 3 to 5 word title for a campus chat conversation based on the query. Do not write explanations. Do not use quotes or markdown. Just return the title.',
            },
            {
              role: 'user',
              content: `Generate a 3-5 word title for: "${userMessage}"`,
            },
          ],
          temperature: 0.3,
          max_tokens: 250,
        },
        {
          headers: {
            Authorization: `Bearer ${this.OPENROUTER_API_KEY}`,
            'Content-Type': 'application/json',
          },
          timeout: 12000,
        },
      );

      let title = response.data?.choices?.[0]?.message?.content?.trim();
      if (title) {
        title = title
          .replace(/^Title:\s*/i, '')
          .replace(/[*#`_"]/g, '')
          .replace(/^["']|["']$/g, '')
          .replace(/[.]$/, '')
          .trim();
        // Take the first line only
        title = title.split('\n')[0].trim();
        if (title.length > 0) {
          return title.length > 30 ? title.slice(0, 30).trim() : title;
        }
      }
    } catch (err: any) {
      this.logger.warn(
        'Failed to generate AI title with OpenRouter, falling back to heuristic',
        err?.message,
      );
    }

    return this.fallbackExtractTitle(userMessage);
  }

  private fallbackExtractTitle(userMessage: string): string {
    const cleaned = userMessage.trim().replace(/[?!.,]/g, '');
    const words = cleaned.split(/\s+/).filter((w) => w.length > 0);
    const shortWords = words.slice(0, 4);
    let title = shortWords
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(' ');
    if (title.length > 28) {
      title = title.slice(0, 28).trim();
    }
    return title || 'New Chat';
  }

  async recommendRoomTitle(chatId: string) {
    const firstUserMsg = await this.ChatMessageModel.findOne({
      where: { chatId, role: 'user' },
      order: [['createdAt', 'ASC']],
>>>>>>> 0840c34 (refactor: update chat system prompt, optimize LLM limits, and enhance location context)
    });

    const subjects = await this.courseService.getSubjects();
    data.push({
      role: 'system',
      content: `these are my universities subjects with their timetable : ${JSON.stringify(subjects)}`,
    });

    const buildings = await this.buildingService.getAllBuildings();
    data.push({
      role: 'system',
      content: `these are my universities buildings with their locations : ${JSON.stringify(buildings)} \n\n when i ask for location then give me the google map link with these coordinates. for example i ask for my class location and room matches with the building then give the that perticular building location`,
    });

    const events = await this.eventService.getEvents();
    data.push({
      role: 'system',
      content: `these are the university events details : ${JSON.stringify(events)}`,
    });

    return data;
  }

  async getChatRoomById(id: string) {
    const room = await this.ChatHistoryModel.findByPk(id);
    if (!room) throw new NotFoundException('Room does not exists');
    return room?.dataValues;
  }

  async handleMessage(
    userMessage: string,
    chatId: string,
    file?: Express.Multer.File,
  ) {
    const room = await this.getChatRoomById(chatId);
    await this.ChatMessageModel.create({
      chatId,
      role: 'user',
      content: userMessage,
    });

    if (file) {
      const pdfData = await pdfParse(file.buffer);
      await this.ChatMessageModel.create({
        chatId,
        role: 'system',
        content: `The user uploaded a PDF file. Content:\n\n${pdfData?.text ?? ''}`,
      });
    }

<<<<<<< HEAD
    const history = await this.ChatMessageModel.findAll({
      where: { chatId },
      order: [['createdAt', 'ASC']],
=======
    // Retrieve recent conversation history (capped at last 6 messages for low latency & token efficiency)
    const history = await this.ChatMessageModel.findAll({
      where: { chatId },
      order: [['createdAt', 'DESC']],
      limit: 6,
>>>>>>> 0840c34 (refactor: update chat system prompt, optimize LLM limits, and enhance location context)
    });
    const trainingData = await this.getModelTrainingData(room.userId);
    // Convert DB history to OpenAI-compatible format
    const formattedMessages = [
      ...trainingData,
      ...history.map((msg) => ({
        role: msg.role,
        content: msg.content,
      })),
    ];

<<<<<<< HEAD
    // Send to OpenRouter API
    const response = await axios.post(
      this.OPENROUTER_URL,
      {
        model: this.OPENROUTER_MODEL,
        messages: formattedMessages,
      },
      {
        headers: {
          Authorization: `Bearer ${this.OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
=======
    try {
      // Send to OpenRouter API with timeout
      const response = await axios.post(
        this.OPENROUTER_URL,
        {
          model: this.OPENROUTER_MODEL,
          messages: formattedMessages,
          temperature: 0.2,
          max_tokens: 900,
>>>>>>> 0840c34 (refactor: update chat system prompt, optimize LLM limits, and enhance location context)
        },
      },
    );

    const botReply = response.data.choices[0].message.content;

    // Save bot reply to DB
    return await this.ChatMessageModel.create({
      chatId,
      role: 'assistant',
      content: botReply,
    });
  }

  async createChatSession(data: CreateChatSessionDto, userId: string) {
    const res = await this.ChatHistoryModel.create({
      title: data.title || 'New Chat',
      userId,
    });

    await this.ChatMessageModel.create({
      chatId: res.dataValues.id,
      role: 'assistant',
      content: ASSISTANCE_GREETING,
    });

    return res.dataValues;
  }

  async getChatMessages(chatId: string) {
    return this.ChatMessageModel.findAll({
      where: { chatId },
      order: [['createdAt', 'ASC']],
    });
  }

  async getChatHistory(userId: string) {
    return this.ChatHistoryModel.findAll({
      where: { userId },
      order: [['createdAt', 'DESC']],
    });
  }

  async deleteChatHistory(id: string) {
    return this.ChatHistoryModel.destroy({ where: { id } });
  }
}

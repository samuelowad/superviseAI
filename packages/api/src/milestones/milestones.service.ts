import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { CreateMilestoneDto } from './dto/create-milestone.dto';
import { UpdateMilestoneDto } from './dto/update-milestone.dto';
import { Milestone } from './entities/milestone.entity';

@Injectable()
export class MilestonesService {
  constructor(
    @InjectRepository(Milestone)
    private readonly milestoneRepository: Repository<Milestone>,
  ) {}

  async listForProfessor(
    professorId: string,
  ): Promise<{ milestones: Array<Record<string, unknown>> }> {
    const milestones = await this.milestoneRepository.find({
      where: { professorId },
      order: { dueDate: 'ASC', createdAt: 'ASC' },
    });

    const now = Date.now();

    return {
      milestones: milestones.map((milestone) => {
        const dueMs = new Date(milestone.dueDate).getTime();
        const dueInDays = Number.isNaN(dueMs)
          ? null
          : Math.ceil((dueMs - now) / (24 * 60 * 60 * 1000));

        return {
          id: milestone.id,
          title: milestone.title,
          stage: milestone.stage,
          due_date: milestone.dueDate,
          due_in_days: dueInDays,
          created_at: milestone.createdAt,
          updated_at: milestone.updatedAt,
        };
      }),
    };
  }

  async createForProfessor(
    professorId: string,
    dto: CreateMilestoneDto,
  ): Promise<{ milestone: Record<string, unknown> }> {
    const milestone = this.milestoneRepository.create({
      professorId,
      title: dto.title.trim(),
      stage: dto.stage?.trim() || 'draft_review',
      dueDate: dto.due_date,
    });

    const saved = await this.milestoneRepository.save(milestone);
    return {
      milestone: {
        id: saved.id,
        title: saved.title,
        stage: saved.stage,
        due_date: saved.dueDate,
        created_at: saved.createdAt,
        updated_at: saved.updatedAt,
      },
    };
  }

  async updateForProfessor(
    professorId: string,
    milestoneId: string,
    dto: UpdateMilestoneDto,
  ): Promise<{ milestone: Record<string, unknown> }> {
    const milestone = await this.milestoneRepository.findOne({
      where: { id: milestoneId, professorId },
    });

    if (!milestone) {
      throw new NotFoundException('Milestone not found for this professor.');
    }

    if (dto.title !== undefined) {
      milestone.title = dto.title.trim();
    }

    if (dto.stage !== undefined) {
      milestone.stage = dto.stage.trim();
    }

    if (dto.due_date !== undefined) {
      milestone.dueDate = dto.due_date;
    }

    const saved = await this.milestoneRepository.save(milestone);

    return {
      milestone: {
        id: saved.id,
        title: saved.title,
        stage: saved.stage,
        due_date: saved.dueDate,
        created_at: saved.createdAt,
        updated_at: saved.updatedAt,
      },
    };
  }
}

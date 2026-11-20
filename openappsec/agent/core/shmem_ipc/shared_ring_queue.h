 

#ifndef __SHARED_RING_QUEUE_H__
#define __SHARED_RING_QUEUE_H__

#include <stdint.h>
#include <stdio.h>

#ifdef __cplusplus
extern "C"
{
#endif // __cplusplus

#define SHARED_MEMORY_SEGMENT_ENTRY_SIZE 4096
#define SHARED_MEMORY_SEGMENT_ENTRY_SIZE_BC 1024
#define MAX_ONE_WAY_QUEUE_NAME_LENGTH 64
#define CORRUPTED_SHMEM_ERROR -2

typedef struct DataSegment {
    char data[SHARED_MEMORY_SEGMENT_ENTRY_SIZE];
} DataSegment;

typedef struct DataSegmentBC {
    char data[SHARED_MEMORY_SEGMENT_ENTRY_SIZE_BC];
} DataSegmentBC;

typedef struct __attribute__((__packed__)) SharedRingQueue {
    char shared_location_name[MAX_ONE_WAY_QUEUE_NAME_LENGTH];
    int32_t owner_fd;
    int32_t user_fd;
    int32_t size_of_memory;
    uint16_t write_pos;
    uint16_t read_pos;
    uint16_t num_of_data_segments;
    DataSegment mgmt_segment;
    DataSegment data_segment[0];
} SharedRingQueue;

SharedRingQueue *
createSharedRingQueue(
    const char *shared_location_name,
    uint16_t num_of_data_segments,
    int is_owner,
    int is_tx
);

void destroySharedRingQueue(SharedRingQueue *queue, int is_owner, int is_tx);
int isQueueEmpty(SharedRingQueue *queue);
int isCorruptedQueue(SharedRingQueue *queue, int is_tx);
int peekToQueue(SharedRingQueue *queue, const char **output_buffer, uint16_t *output_buffer_size);
int popFromQueue(SharedRingQueue *queue);
int pushToQueue(SharedRingQueue *queue, const char *input_buffer, const uint16_t input_buffer_size);
void resetRingQueue(SharedRingQueue *queue, uint16_t num_of_data_segments);
void dumpRingQueueShmem(SharedRingQueue *queue);

int
pushBuffersToQueue(
    SharedRingQueue *queue,
    const char **input_buffers,
    const uint16_t *input_buffers_sizes,
    const uint8_t num_of_input_buffers
);

#ifdef __cplusplus
}
#endif // __cplusplus

#endif // __SHARED_RING_QUEUE_H__

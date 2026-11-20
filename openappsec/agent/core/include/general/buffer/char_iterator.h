 

#ifndef __BUFFER_CHAR_ITERATOR_H__
#define __BUFFER_CHAR_ITERATOR_H__

#include <iterator>

class Buffer::CharIterator
{
public:
    using value_type = u_char;

    CharIterator() {}
    void operator++();
    void operator++(int) { ++(*this); }
    void operator+=(uint);
    CharIterator operator+(uint) const;
    bool operator==(const CharIterator &other) const;
    bool operator!=(const CharIterator &other) const { return !((*this)==other); }
    const u_char & operator*() const;

private:
    friend class Buffer;
    CharIterator(const SegIterator &_cur, const SegIterator &_end, uint _offset);
    CharIterator(const SegIterator &_end);
    SegIterator cur_seg, end_seg;
    const u_char *ptr = nullptr;
    uint offset = 0, size = 0;
};

namespace std
{

template <>
struct iterator_traits<Buffer::CharIterator>
{
    using value_type = u_char;
};

}; // namespace std

#endif // __BUFFER_CHAR_ITERATOR_H__

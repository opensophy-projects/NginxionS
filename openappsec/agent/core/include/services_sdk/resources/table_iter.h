 

#ifndef __TABLE_ITER_H__
#define __TABLE_ITER_H__

#include "i_table_iter.h"

template <typename T>
class Table;

class TableIter
{
public:
    void operator++() { ++(*iter); }
    void operator++(int)  { (*iter)++; }
    bool operator==(const TableIter &other) const { return iter->getUniqueId() == other.iter->getUniqueId(); }
    bool operator!=(const TableIter &other) const { return iter->getUniqueId() != other.iter->getUniqueId(); }
    void setEntry() { iter->setEntry(); }
    void unsetEntry() { iter->unsetEntry(); }

private:
    template <typename Key> friend class Table;
    TableIter(const std::shared_ptr<I_TableIter> &_iter) : iter(_iter) {}

    std::shared_ptr<I_TableIter> iter;
};

#endif // __TABLE_ITER_H__

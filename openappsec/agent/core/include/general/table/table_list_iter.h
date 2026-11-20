 

#ifndef __TABLE_LIST_ITER_H__
#define __TABLE_LIST_ITER_H__

#ifndef __TABLE_IMPL_H__
#error "table_list_iter.h should not be included directly"
#endif // __TABLE_IMPL_H__

#include "context.h"

namespace TableHelper
{

template <typename Key>
class KeyNodeIter : public I_TableIter, public Constant
{
public:
    KeyNodeIter(const KeyNodePtr<Key> &iter);
    void operator++() override;
    void operator++(int) override;
    void setEntry() override;
    void unsetEntry() override;
    void * getUniqueId() const override;

private:
    void moveNext();

    KeyNodePtr<Key> curr;
    Context ctx;
};

template <typename Key>
KeyNodeIter<Key>::KeyNodeIter(const KeyNodePtr<Key> &iter) : curr(iter)
{
}

template <typename Key>
void
KeyNodeIter<Key>::operator++()
{
    moveNext();
}

template <typename Key>
void
KeyNodeIter<Key>::operator++(int)
{
    moveNext();
}

template <typename Key>
void
KeyNodeIter<Key>::setEntry()
{
    if (!curr || !curr->isActive()) return;
    ctx.registerValue(primary_key, curr->getKey());
    ctx.activate();
}

template <typename Key>
void
KeyNodeIter<Key>::unsetEntry()
{
    ctx.deactivate();
}

template <typename Key>
void *
KeyNodeIter<Key>::getUniqueId() const
{
    return curr.get();
}

template <typename Key>
void
KeyNodeIter<Key>::moveNext()
{
    while (curr != nullptr) {
        curr = curr->getNext();
        if (curr != nullptr && curr->isActive()) return;
    }
}

} // TableHelper

#endif // __TABLE_LIST_ITER_H__

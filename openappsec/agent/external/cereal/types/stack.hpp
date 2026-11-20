/*! \file stack.hpp
    \brief Support for types found in \<stack\>
    \ingroup STLSupport */

#ifndef CEREAL_TYPES_STACK_HPP_
#define CEREAL_TYPES_STACK_HPP_

#include <cereal/cereal.hpp>
#include <stack>

// The default container for stack is deque, so let's include that too
#include <cereal/types/deque.hpp>

namespace cereal
{
  namespace stack_detail
  {
    //! Allows access to the protected container in stack
    template <class T, class C> inline
    C const & container( std::stack<T, C> const & stack )
    {
      struct H : public std::stack<T, C>
      {
        static C const & get( std::stack<T, C> const & s )
        {
          return s.*(&H::c);
        }
      };

      return H::get( stack );
    }
  }

  //! Saving for std::stack
  template <class Archive, class T, class C> inline
  void CEREAL_SAVE_FUNCTION_NAME( Archive & ar, std::stack<T, C> const & stack )
  {
    ar( CEREAL_NVP_("container", stack_detail::container( stack )) );
  }

  //! Loading for std::stack
  template <class Archive, class T, class C> inline
  void CEREAL_LOAD_FUNCTION_NAME( Archive & ar, std::stack<T, C> & stack )
  {
    C container;
    ar( CEREAL_NVP_("container", container) );
    stack = std::stack<T, C>( std::move( container ) );
  }
} // namespace cereal

#endif // CEREAL_TYPES_STACK_HPP_
